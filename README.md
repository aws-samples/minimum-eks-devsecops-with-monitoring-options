# Sample DevSecOps with Monitoring on Amazon EKS

Many organizations are or are considering migrating their applications and/or software to containers over traditional virtual machines given that they are incredibly fast, easy to maintain, have simpler deployment life-cycles, and are much easier to spin up and down. This can greatly reduce the cost and increase efficiency. For a secure container life cycle management, container image hardening and end-to-end security checks are a most important and critical factor. Containers need to be secured by default before the containers are used or deployed.  

This sample code base will demonstrate how to build an end to end DevSecOps pipeline on Amazon EKS using IaC code scanning static scanning and dynamic (runtime) scanning using native AWS services as well as 3rd party services and COntinous monitoring and alerting with Prometheus and Grafana. The products/services used are -
![image](https://user-images.githubusercontent.com/62891988/182590929-8dc8674a-195d-41a1-9b47-dced458262a7.png)


## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
