import { Stack, 
  Fn,
  StackProps,
  aws_kms, 
  aws_s3,
  CfnOutput, 
  aws_ecr, 
  Aws, 
  aws_iam, 
  aws_codebuild, 
  aws_eks, 
  aws_codecommit, 
  aws_codepipeline, 
  aws_codepipeline_actions,
  aws_secretsmanager, 
  aws_ec2 } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { pipeline } from 'stream';


export class EksDevsecopsObservabilityStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

// Fetch existing VPC

    const vpc = aws_ec2.Vpc.fromLookup(this, 'VPC', {
      vpcId: 'vpc-0a242262d04e29a51'
    });


    // EKS Cluster

  const clusterRole = new aws_iam.Role(this, 'ClusterRole', {
    assumedBy: new aws_iam.AccountRootPrincipal()
  });

  const cluster = new aws_eks.Cluster(this, 'EKS_Cluster', {
    vpc: vpc,
    endpointAccess: aws_eks.EndpointAccess.PRIVATE,
    mastersRole: clusterRole,
    version: aws_eks.KubernetesVersion.V1_21,
    defaultCapacity: 0,
    clusterName: 'eks-cluster',
    clusterLogging: [
      aws_eks.ClusterLoggingTypes.API,
      aws_eks.ClusterLoggingTypes.AUTHENTICATOR,
      aws_eks.ClusterLoggingTypes.SCHEDULER,
      aws_eks.ClusterLoggingTypes.CONTROLLER_MANAGER,
      aws_eks.ClusterLoggingTypes.AUDIT
    ],
  });

//
// Choice of Node groups with and without LaunchTemplate specifications
//

  cluster.addNodegroupCapacity('extra-ng-without-lt', {
    instanceTypes: [
      new aws_ec2.InstanceType('t3.small'),
    ],
    minSize: 1,
    maxSize: 2,
    nodegroupName: 'extra-ng-without-lt',
  });

  const launchTemplateRequireImdsv2Aspect = new aws_ec2.LaunchTemplateRequireImdsv2Aspect(/* all optional props */ {
    suppressWarnings: false,
  });


  const userData = aws_ec2.UserData.forLinux();
  userData.addCommands(
    'set -o xtrace',
    `/etc/eks/bootstrap.sh ${cluster.clusterName}`,
  );

  const lt = new aws_ec2.CfnLaunchTemplate(this, 'LaunchTemplate', {
    
    launchTemplateData: {
      imageId: 'ami-061944722678088b6', // custom AMI
      instanceType: 't3.small',
      userData: Fn.base64(userData.render()),
      metadataOptions: {
        httpTokens: 'required',
        httpPutResponseHopLimit: 1,
      },      
    },
  });


  cluster.addNodegroupCapacity('extra-ng-with-lt', {
    launchTemplateSpec: {
      id: lt.ref,
      version: lt.attrLatestVersionNumber,
      
    },
  });


    // ECR Repository 

    const ecrRepo = new aws_ecr.Repository(this, 'devsecops-repo-ecr', { 
  //    repositoryName: 'devsecops-repo-ecr', 
      encryption: aws_ecr.RepositoryEncryption.KMS,
      imageTagMutability: aws_ecr.TagMutability.MUTABLE,
      imageScanOnPush: true
    });

    const repo = new aws_codecommit.Repository(this, "devsecops-eks-cc-repository", {
      repositoryName: "devsecops-eks-cc-repository",
      description: "devsecops-eks-cc-repository",
    });


    const kmskey = new aws_kms.Key(this, 'MyKey', {
      enableKeyRotation: true,
    });

const buildRole = new aws_iam.Role(this, 'EKSCodeBuildRole', {
  assumedBy: new aws_iam.ServicePrincipal('codebuild.amazonaws.com'),
  description: 'EKS CB Role',
 // roleName: 'EKSCodeBuildRole',
})


buildRole.addManagedPolicy(aws_iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'))


// Fetch DockerHub secrets for docker-cli login

const dockerhub = aws_secretsmanager.Secret.fromSecretNameV2(this, 'dockerhub', 'dockerhub')
const dockerhubtwo = aws_secretsmanager.Secret.fromSecretNameV2(this, 'dockerhubtwo', 'dockerhubtwo')

buildRole.addToPolicy(
  new aws_iam.PolicyStatement({
    sid: 'StsAccess',
    actions: [
      "sts:AssumeRole",
      "sts:SetSourceIdentity"
    ],
    resources: [
      buildRole.roleArn
    ],
  }),
);

buildRole.addToPolicy(
  new aws_iam.PolicyStatement({
    sid: 'SecretsAccess',
    actions: [
      "secretsmanager:GetSecretValue"
    ],
    resources: [
      dockerhub.secretArn,
      dockerhubtwo.secretArn
    ],
  }),
);

buildRole.addToPolicy(
  new aws_iam.PolicyStatement({
    sid: 'AccessDecodeAuth',
    actions: [
      "sts:DecodeAuthorizationMessage",
    ],
    resources: [buildRole.roleArn],
  }),
);

buildRole.addToPolicy(
  new aws_iam.PolicyStatement({
    sid: 'DescribeEKS',
    actions: [
        "eks:DescribeAddon",
        "eks:DescribeCluster",
        "eks:DescribeIdentityProviderConfig",
        "eks:DescribeNodegroup",
        "eks:DescribeUpdate"
    ],
    resources: [`${cluster.clusterArn}`],
  }),
);

    // CODEBUILD - project - IaC Security

const codebuildCheckov = new aws_codebuild.PipelineProject(this, "cdkdeploycheckov", {
  projectName: 'cdk_security_check_checkov',
  role: buildRole,
  encryptionKey: kmskey,
  environment: {
      computeType: aws_codebuild.ComputeType.SMALL,
      buildImage: aws_codebuild.LinuxBuildImage.fromDockerRegistry("public.ecr.aws/ackstorm/checkov:latest"),
      privileged: false,          
  },
  buildSpec: aws_codebuild.BuildSpec.fromObject({
  version: "0.2",
  phases: {
    build: {
      commands: [
        'skip_checks=`paste -d, -s kubernetes/skip_checks.config`',
        'checkov --framework cloudformation --skip-check $skip_checks -f cdk.out/EksDevsecopsObservabilityStack.template.json',
      ]
    },
  },
  artifacts: {
    files: [
      'kubernetes/*',
      'Dockerfile',
      'requirements.txt',
      'server.py',
    ]
  }
})
});

    // CODEBUILD - project - Static Scan
    
    const project = new aws_codebuild.Project(this, 'devsecops-project-eks-static-scan', {
      projectName: 'devsecops-project-eks-static-scan',
      role: buildRole,
      encryptionKey: kmskey,
      environment: {
        buildImage: aws_codebuild.LinuxBuildImage.AMAZON_LINUX_2_2,
        privileged: true,
      },
      environmentVariables: {
        'ECR_REPOSITORY_URI': {
          value: `${ecrRepo.repositoryUri}`
        },
        'AWS_DEFAULT_REGION': {
          value: `${Aws.REGION}`
        },  
        'HADOLINT_IMAGE_TAG': {
          value: `hadolint-latest`
          },                                   
       'IMAGE_REPO_NAME': {
        value: `${ecrRepo.repositoryName}`
       },
       'Account_Id': {
        value: `${Aws.ACCOUNT_ID}`
      }, 
       'IMAGE_TAG': {
        value: `app-latest`
       }       
      },
      buildSpec: aws_codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            commands: [
                'env',
                'export TAG=${CODEBUILD_RESOLVED_SOURCE_VERSION}',
                'export dockerhub_username=`aws secretsmanager get-secret-value --secret-id dockerhub| jq --raw-output ".SecretString" | jq -r .username`',
                'export dockerhub_password=`aws secretsmanager get-secret-value --secret-id  dockerhubtwo| jq --raw-output ".SecretString" | jq -r .password`',
                'echo "############Login to DockerHub############"',
                'docker login -u $dockerhub_username -p $dockerhub_password',
            ]
          },
          build: {
            commands: [
              'mkdir -p $CODEBUILD_SRC_DIR/build/',
              'pwd',
              'ls',
              'cp kubernetes/hadolint.yaml $CODEBUILD_SRC_DIR/build/hadolint.yaml',
              'cp Dockerfile $CODEBUILD_SRC_DIR/build/Dockerfile',
              'cp requirements.txt $CODEBUILD_SRC_DIR/build/requirements.txt',
              'cp server.py $CODEBUILD_SRC_DIR/build/server.py',
              'echo "############DOCKER FILE LINT STATGE############"',
              'ECR_LOGIN=$(aws ecr get-login --region $AWS_DEFAULT_REGION --no-include-email)',
              'echo "############Logging in to Amazon ECR############"',
              '$ECR_LOGIN',
              // OPTIONAL - Below steps are to escape Github Rate limits. You can push to a private repository like Amazon ECR            
             //  'docker run --rm -i -v ${PWD}/.hadolint.yaml:/.hadolint.yaml hadolint/hadolint:v1.16.2 hadolint -f json - < ./Dockerfile',
              'docker pull $ECR_REPOSITORY_URI:$HADOLINT_IMAGE_TAG',
              'cd $CODEBUILD_SRC_DIR/build',
              'ls -tlr',
              'docker run --rm -i -v ${PWD}/hadolint.yaml:/.hadolint.yaml $ECR_REPOSITORY_URI:$HADOLINT_IMAGE_TAG hadolint -f json - < ./Dockerfile',
              'echo "############DOCKER FILE LINT STATGE - PASSED############"',
              `docker build -f Dockerfile -t $ECR_REPOSITORY_URI:app-latest .`,
              'docker tag $ECR_REPOSITORY_URI:app-latest $ECR_REPOSITORY_URI:$IMAGE_TAG',
              'docker history --no-trunc $ECR_REPOSITORY_URI:$IMAGE_TAG'
            ]
          },
          post_build: {
            commands: [
              'bash -c "if [ /"$CODEBUILD_BUILD_SUCCEEDING/" == /"0/" ]; then exit 1; fi"',
              'echo Build completed on `date`',
              'docker push $ECR_REPOSITORY_URI:$IMAGE_TAG',
              'echo "Deep Vulnerability Scan By Anchore Engine"',
              'echo "POST_BUILD Phase Will fail if Container fails with Vulnerabilities"',
              'export COMPOSE_INTERACTIVE_NO_CLI=1',
              'curl -s https://ci-tools.anchore.io/inline_scan-v0.3.3 | bash -s -- $ECR_REPOSITORY_URI:$IMAGE_TAG',
            ]
          }
        },
        artifacts: {
          files: [
            'kubernetes/*',
            'Dockerfile',
            'requirements.txt',
            'server.py',
          ]
        }
      })
    });


   // CODEBUILD - project - Deploy to EKS
    
   const projectEks = new aws_codebuild.Project(this, 'devsecops-project-eks-deploy', {
    projectName: 'devsecops-project-eks-deploy',
    role: buildRole,
    encryptionKey: kmskey,
    environment: {
      buildImage: aws_codebuild.LinuxBuildImage.AMAZON_LINUX_2_2,
      privileged: true,
    },
    environmentVariables: {
      'ECR_REPOSITORY_URI': {
        value: `${ecrRepo.repositoryUri}`
      },
      'AWS_DEFAULT_REGION': {
        value: `${Aws.REGION}`
      },
      'AWS_CLUSTER_NAME': {
        value: `${cluster.clusterName}`
      },       
      'HADOLINT_IMAGE_TAG': {
        value: `hadolint-latest`
      },                                   
     'IMAGE_REPO_NAME': {
      value: `${ecrRepo.repositoryName}`
      },
     'Account_Id': {
      value: `${Aws.ACCOUNT_ID}`
     }, 
     'IMAGE_TAG': {
      value: `app-latest`
     }       
    },
    buildSpec: aws_codebuild.BuildSpec.fromObject({
      version: "0.2",
      phases: { 
        pre_build: {
          commands: [
            'echo "############Installing app dependencies############"',
            'curl -o kubectl https://amazon-eks.s3.us-west-2.amazonaws.com/1.18.9/2020-11-02/bin/linux/amd64/kubectl',
            'chmod +x ./kubectl',
            'mkdir -p $HOME/bin && cp ./kubectl $HOME/bin/kubectl && export PATH=$PATH:$HOME/bin',
            'export PATH=$PATH:$HOME/bin >> ~/.bashrc',
            'source ~/.bashrc',
            'echo "############Check kubectl version############"',
            'kubectl version --short --client',
            'echo "############check config############"',       
            'aws eks update-kubeconfig --name $AWS_CLUSTER_NAME --region $AWS_DEFAULT_REGION',
            'kubectl config view --minify',
            'kubectl get configmap aws-auth -o yaml -n kube-system',
          ]
        },
        build: {
          commands: [
            'echo "############Deploy to EKS Cluster############"',          
            'kubectl apply -f kubernetes/deployment.yaml',
            'echo "############List Pods############"',            
            'kubectl get pods',
            'docker images',
          ]
        }
      },
    })
  });    




  cluster.awsAuth.addMastersRole(projectEks.role!);
  project.addToRolePolicy(new aws_iam.PolicyStatement({
    actions: [
      "eks:DescribeAddon",
      "eks:DescribeCluster",
      "eks:DescribeIdentityProviderConfig",
      "eks:DescribeNodegroup",
      "eks:DescribeUpdate"
    ],
    resources: [`${cluster.clusterArn}`],
  }));

// Pipleine for EKS

    const sourceOutput = new aws_codepipeline.Artifact();
    const buildOutput = new aws_codepipeline.Artifact();
    const buildcheckovOutput = new aws_codepipeline.Artifact();
    const deployOutput = new aws_codepipeline.Artifact();

    const sourceAction = new aws_codepipeline_actions.CodeCommitSourceAction({
      actionName: 'CodeCommit_Source',
      repository: repo,
      branch: 'main',
      output: sourceOutput
    });

    const checkovAction = new aws_codepipeline_actions.CodeBuildAction({
      actionName: 'CodeBuild',
      project: codebuildCheckov,
      input: sourceOutput,
      outputs: [buildcheckovOutput], 
    });

    const buildAction = new aws_codepipeline_actions.CodeBuildAction({
      actionName: 'CodeBuild',
      project: project,
      input: buildcheckovOutput,
      outputs: [buildOutput], 
    });

    const manualApprovalAction = new aws_codepipeline_actions.ManualApprovalAction({
      actionName: 'Approve',
    });

    const deployAction = new aws_codepipeline_actions.CodeBuildAction({
      actionName: 'CodeBuild',
      project: projectEks,
      input: buildOutput,
      outputs: [deployOutput], 
    });

new aws_codepipeline.Pipeline(this, 'devsecops-project-eks-pipeline', {
      stages: [
        {
          stageName: 'Source-Input',
          actions: [sourceAction],
        },
        {
          stageName: 'Checkov-IaC-Code-Security-Checks',
          actions: [checkovAction],
        },
        {
          stageName: 'Approve-Checkov-Checks',
          actions: [manualApprovalAction],
        },                
        {
          stageName: 'Container-Scan-Hadolint-AnchoreEngine',
          actions: [buildAction],
        },
        {
          stageName: 'Approve-Deployment',
          actions: [manualApprovalAction],
        },
        {
          stageName: 'Deploy-to-EKS',
          actions: [deployAction],
        }
      ]
    });




    ecrRepo.grantPullPush(project.role!)
    project.addToRolePolicy(new aws_iam.PolicyStatement({
      actions: [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
        ],
      resources: [ecrRepo.repositoryArn]
    }));
  



      // create an Output
      
      new CfnOutput(this, 'EKS_Cluster_Name', {
        value: cluster.clusterName,
        description: 'EKS Cluster',
        exportName: 'EKSClusterName',
      });
      new CfnOutput(this, 'ECRRepo', {
        value: ecrRepo.repositoryName,
        description: 'ECR Repo',
        exportName: 'ECRrepo',
      }); 
      new CfnOutput(this, 'CodeCommitRepo', {
        value: repo.repositoryName,
        description: 'CCRepo',
        exportName: 'CCrepo',
      }); 
      new CfnOutput(this, 'CodePipelineName', {
        value: pipeline.name,
        description: 'CodePipeline',
        exportName: 'CPName',
      }); 
      new CfnOutput(this, 'StaticScanCodeBuild', {
        value: project.projectName,
        description: 'StaicScan CodeBuild',
        exportName: 'StaticScanProject',
      }); 
      new CfnOutput(this, 'EKSDeployCodeBuild', {
        value: projectEks.projectName,
        description: 'EKSDeploy CodeBuild',
        exportName: 'EKSDeployProject',
      }); 
      new CfnOutput(this, 'CheckovCodeBuild', {
        value: codebuildCheckov.projectName,
        description: 'Checkov CodeBuild',
        exportName: 'CheckovProject',
      }); 
  }
}
