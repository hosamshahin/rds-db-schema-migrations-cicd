import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";

/**
 * A stack for the RDS Database setup
 */
export class DatabaseStack extends Construct {
  public readonly vpc: ec2.Vpc;
  public readonly secretName: cdk.CfnOutput;
  public readonly secretArn: cdk.CfnOutput;
  public readonly securityGroupOutput: ec2.SecurityGroup;
  public readonly defaultDBName: string = "demo";

  constructor(scope: Construct, id: string, stageName: string) {
    super(scope, id);

    // VPC
    this.vpc = new ec2.Vpc(this, 'RdsVpc');

    // Database Security group
    const securityGroup = new ec2.SecurityGroup(this, 'LambdaPostgresConnectionSG', {
      vpc: this.vpc,
      description: "Lambda security group to connect to Postgres db.",
      allowAllOutbound: true
    })

    securityGroup.addIngressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.tcp(5432), 'Allow Postgres Communication')

    // Database cluster
    const cluster = new rds.ServerlessCluster(this, 'DBCluster', {
      engine: rds.DatabaseClusterEngine.AURORA_POSTGRESQL,
      vpc: this.vpc,
      parameterGroup: rds.ParameterGroup.fromParameterGroupName(this, 'ParameterGroup', 'default.aurora-postgresql10'),
      enableDataApi: true,
      securityGroups: [
        securityGroup
      ],
      defaultDatabaseName: this.defaultDBName,
      scaling: {
        minCapacity: rds.AuroraCapacityUnit.ACU_2,
        maxCapacity: rds.AuroraCapacityUnit.ACU_4
      },
      credentials: rds.Credentials.fromGeneratedSecret('syscdk'),
    });

    // Configure automatic secrets rotation
    cluster.addRotationSingleUser({
      automaticallyAfter: cdk.Duration.days(7),
      excludeCharacters: '!@#$%^&*',
    });

    // Setup bastion server to connect from local machine - only dev environment.
    if (stageName === 'Development') {
      new ec2.BastionHostLinux(this, 'BastionHost', {
        vpc: this.vpc
      });
    }

    // Outputs
    this.secretName = new cdk.CfnOutput(this, 'secretName', {
      value: cluster.secret?.secretName || '',
    });

    this.secretArn = new cdk.CfnOutput(this, 'secretArn', {
      value: cluster.secret?.secretArn || '',
    });

    this.securityGroupOutput = securityGroup;
  }
}
